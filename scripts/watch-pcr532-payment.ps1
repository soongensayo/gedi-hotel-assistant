param(
  [string]$BackendUrl = "http://localhost:3001/api/checkin/nfc-uid",
  [string]$ReaderNamePattern = "PCR532|SmartCard|Smart Card|Usbccid|CCID|NFC|RFID|ACR122",
  [switch]$DebugReader,
  [switch]$ListReaders,
  [switch]$PollUid,
  [switch]$SendIfAlreadyPresent,
  [switch]$TestPost
)

$ErrorActionPreference = "Stop"

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PcscDemo {
  public const uint SCARD_SCOPE_SYSTEM = 2;
  public const uint SCARD_STATE_UNAWARE = 0x0000;
  public const uint SCARD_STATE_CHANGED = 0x0002;
  public const uint SCARD_STATE_UNKNOWN = 0x0004;
  public const uint SCARD_STATE_UNAVAILABLE = 0x0008;
  public const uint SCARD_STATE_EMPTY = 0x0010;
  public const uint SCARD_STATE_PRESENT = 0x0020;
  public const uint SCARD_STATE_ATRMATCH = 0x0040;
  public const uint SCARD_STATE_EXCLUSIVE = 0x0080;
  public const uint SCARD_STATE_INUSE = 0x0100;
  public const uint SCARD_STATE_MUTE = 0x0200;
  public const uint SCARD_SHARE_SHARED = 2;
  public const uint SCARD_PROTOCOL_T0 = 1;
  public const uint SCARD_PROTOCOL_T1 = 2;
  public const uint SCARD_LEAVE_CARD = 0;

  [StructLayout(LayoutKind.Sequential)]
  public struct IoRequest {
    public uint protocol;
    public uint pciLength;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ReaderState {
    [MarshalAs(UnmanagedType.LPTStr)]
    public string readerName;
    public IntPtr userData;
    public uint currentState;
    public uint eventState;
    public uint atrLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 36)]
    public byte[] atr;
  }

  [DllImport("winscard.dll")]
  public static extern int SCardEstablishContext(
    uint scope,
    IntPtr reserved1,
    IntPtr reserved2,
    out IntPtr context
  );

  [DllImport("winscard.dll", EntryPoint = "SCardListReadersW", CharSet = CharSet.Unicode)]
  public static extern int SCardListReaders(
    IntPtr context,
    string groups,
    char[] readers,
    ref int readerCount
  );

  [DllImport("winscard.dll", EntryPoint = "SCardGetStatusChangeW", CharSet = CharSet.Unicode)]
  public static extern int SCardGetStatusChange(
    IntPtr context,
    int timeoutMs,
    [In, Out] ReaderState[] readerStates,
    int readerCount
  );

  [DllImport("winscard.dll")]
  public static extern int SCardReleaseContext(IntPtr context);

  [DllImport("winscard.dll", EntryPoint = "SCardConnectW", CharSet = CharSet.Unicode)]
  public static extern int SCardConnect(
    IntPtr context,
    string reader,
    uint shareMode,
    uint preferredProtocols,
    out IntPtr card,
    out uint activeProtocol
  );

  [DllImport("winscard.dll")]
  public static extern int SCardDisconnect(IntPtr card, uint disposition);

  [DllImport("winscard.dll")]
  public static extern int SCardTransmit(
    IntPtr card,
    ref IoRequest sendPci,
    byte[] sendBuffer,
    int sendLength,
    IntPtr recvPci,
    byte[] recvBuffer,
    ref int recvLength
  );

  public static IntPtr EstablishContext() {
    IntPtr context;
    int result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, IntPtr.Zero, IntPtr.Zero, out context);
    if (result != 0) {
      throw new InvalidOperationException("SCardEstablishContext failed: 0x" + result.ToString("X8"));
    }
    return context;
  }

  public static string[] ListReaders(IntPtr context) {
    int count = 0;
    int result = SCardListReaders(context, null, null, ref count);
    if (result != 0) {
      throw new InvalidOperationException("SCardListReaders size failed: 0x" + result.ToString("X8"));
    }

    char[] buffer = new char[count];
    result = SCardListReaders(context, null, buffer, ref count);
    if (result != 0) {
      throw new InvalidOperationException("SCardListReaders failed: 0x" + result.ToString("X8"));
    }

    string allReaders = new string(buffer);
    List<string> parsed = new List<string>();
    foreach (string reader in allReaders.Split('\0')) {
      if (!String.IsNullOrWhiteSpace(reader)) {
        parsed.Add(reader);
      }
    }
    return parsed.ToArray();
  }

  public static ReaderState NewReaderState(string readerName) {
    return new ReaderState {
      readerName = readerName,
      userData = IntPtr.Zero,
      currentState = SCARD_STATE_UNAWARE,
      eventState = 0,
      atrLength = 0,
      atr = new byte[36]
    };
  }

  public static string TryReadUid(IntPtr context, string readerName, out int errorCode) {
    IntPtr card;
    uint protocol;
    errorCode = SCardConnect(
      context,
      readerName,
      SCARD_SHARE_SHARED,
      SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
      out card,
      out protocol
    );

    if (errorCode != 0) {
      return null;
    }

    try {
      IoRequest sendPci = new IoRequest {
        protocol = protocol,
        pciLength = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(IoRequest))
      };

      byte[] command = new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 };
      byte[] response = new byte[258];
      int responseLength = response.Length;
      errorCode = SCardTransmit(
        card,
        ref sendPci,
        command,
        command.Length,
        IntPtr.Zero,
        response,
        ref responseLength
      );

      if (errorCode != 0 || responseLength < 2) {
        return null;
      }

      byte sw1 = response[responseLength - 2];
      byte sw2 = response[responseLength - 1];
      if (sw1 != 0x90 || sw2 != 0x00 || responseLength <= 2) {
        errorCode = unchecked((int)0x6F00);
        return null;
      }

      byte[] uid = new byte[responseLength - 2];
      Array.Copy(response, uid, uid.Length);
      return BitConverter.ToString(uid).Replace("-", "");
    } finally {
      SCardDisconnect(card, SCARD_LEAVE_CARD);
    }
  }
}
"@

function Send-DemoTap {
  param([string]$Uid)

  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri $BackendUrl `
      -ContentType "application/json" `
      -Body (@{ uid = $Uid } | ConvertTo-Json -Compress) | Out-Null
    Write-Host "[PCR532] Sent tap to backend."
  } catch {
    Write-Warning "[PCR532] Could not notify backend: $($_.Exception.Message)"
  }
}

function Get-AtrHex {
  param([PcscDemo+ReaderState]$State)

  if ($State.atrLength -le 0) {
    return "532"
  }

  $bytes = $State.atr[0..([int]$State.atrLength - 1)]
  return (($bytes | ForEach-Object { $_.ToString("X2") }) -join "")
}

function Format-CardState {
  param([uint32]$State)

  $names = New-Object System.Collections.Generic.List[string]
  if (($State -band [PcscDemo]::SCARD_STATE_CHANGED) -ne 0) { $names.Add("CHANGED") }
  if (($State -band [PcscDemo]::SCARD_STATE_UNKNOWN) -ne 0) { $names.Add("UNKNOWN") }
  if (($State -band [PcscDemo]::SCARD_STATE_UNAVAILABLE) -ne 0) { $names.Add("UNAVAILABLE") }
  if (($State -band [PcscDemo]::SCARD_STATE_EMPTY) -ne 0) { $names.Add("EMPTY") }
  if (($State -band [PcscDemo]::SCARD_STATE_PRESENT) -ne 0) { $names.Add("PRESENT") }
  if (($State -band [PcscDemo]::SCARD_STATE_ATRMATCH) -ne 0) { $names.Add("ATRMATCH") }
  if (($State -band [PcscDemo]::SCARD_STATE_EXCLUSIVE) -ne 0) { $names.Add("EXCLUSIVE") }
  if (($State -band [PcscDemo]::SCARD_STATE_INUSE) -ne 0) { $names.Add("INUSE") }
  if (($State -band [PcscDemo]::SCARD_STATE_MUTE) -ne 0) { $names.Add("MUTE") }

  if ($names.Count -eq 0) {
    return "0x$($State.ToString("X8"))"
  }

  return "$($names -join "|") (0x$($State.ToString("X8")))"
}

function Format-PcscError {
  param([int]$ErrorCode)

  switch ($ErrorCode) {
    0 { return "OK" }
    -2146435062 { return "TIMEOUT / no state change" }
    -2146435065 { return "UNKNOWN_READER" }
    -2146435044 { return "NO_SMARTCARD / no card in field" }
    -2146434967 { return "REMOVED_CARD / no card in field" }
    -2146434968 { return "RESET_CARD" }
    -2146434969 { return "UNPOWERED_CARD" }
    -2146434970 { return "UNRESPONSIVE_CARD" }
    -2146434971 { return "UNSUPPORTED_CARD" }
    default { return "0x$($ErrorCode.ToString("X8"))" }
  }
}

Write-Host "[PCR532] Watching PC/SC readers. Backend: $BackendUrl"

if ($TestPost) {
  Write-Host "[PCR532] Sending test tap to backend..."
  Send-DemoTap -Uid "532"
  exit 0
}

$context = [PcscDemo]::EstablishContext()

try {
  $allReaders = [PcscDemo]::ListReaders($context)
  $readers = @($allReaders | Where-Object { $_ -match $ReaderNamePattern })

  if ($readers.Count -eq 0) {
    $readers = @($allReaders)
  }

  if ($readers.Count -eq 0) {
    throw "No PC/SC smart card readers found. Check that the PCR532 is plugged in and the Smart Card service is running."
  }

  Write-Host "[PCR532] Readers:"
  $readers | ForEach-Object { Write-Host "  - $_" }

  if ($ListReaders) {
    Write-Host "[PCR532] All PC/SC readers:"
    $allReaders | ForEach-Object { Write-Host "  - $_" }
    exit 0
  }

  if ($PollUid) {
    Write-Host "[PCR532] Poll UID mode. Waiting for a readable card..."
    Write-Host "[PCR532] Hold the NTAG/MIFARE card flat on the reader until a UID appears."
    $lastUid = ""
    $lastPollLogAt = Get-Date

    while ($true) {
      foreach ($readerName in $readers) {
        $errorCode = 0
        $uid = [PcscDemo]::TryReadUid($context, $readerName, [ref]$errorCode)

        if ($uid) {
          if ($uid -ne $lastUid) {
            Write-Host "[PCR532] UID detected on '$readerName': $uid"
            Send-DemoTap -Uid $uid
            $lastUid = $uid
          }
        } else {
          if ($DebugReader -and ((Get-Date) - $lastPollLogAt).TotalSeconds -ge 3) {
            Write-Host "[PCR532] Polling '$readerName'... no UID yet ($(Format-PcscError -ErrorCode $errorCode))"
            $lastPollLogAt = Get-Date
          }
          if ($errorCode -ne 0) {
            $lastUid = ""
          }
        }
      }

      Start-Sleep -Milliseconds 250
    }
  }

  $states = [PcscDemo+ReaderState[]]::new($readers.Count)
  for ($i = 0; $i -lt $readers.Count; $i++) {
    $states[$i] = [PcscDemo]::NewReaderState($readers[$i])
  }
  $presentByReader = @{}
  $lastStateByReader = @{}

  $initialResult = [PcscDemo]::SCardGetStatusChange($context, 1000, $states, $states.Count)
  if ($initialResult -ne 0 -and $initialResult -ne -2146435062) {
    Write-Warning "[PCR532] Initial SCardGetStatusChange failed: 0x$($initialResult.ToString("X8"))"
  }

  for ($i = 0; $i -lt $states.Count; $i++) {
    $state = $states[$i]
    $readerName = $state.readerName
    $isPresent = (($state.eventState -band [PcscDemo]::SCARD_STATE_PRESENT) -ne 0)
    $presentByReader[$readerName] = $isPresent
    $lastStateByReader[$readerName] = $state.eventState
    $state.currentState = $state.eventState
    $states[$i] = $state

    if ($DebugReader) {
      Write-Host "[PCR532] Initial state '$readerName': $(Format-CardState -State $state.eventState)"
    }
  }

  if ($SendIfAlreadyPresent) {
    for ($i = 0; $i -lt $states.Count; $i++) {
      $state = $states[$i]
      $readerName = $state.readerName
      $isPresent = (($state.eventState -band [PcscDemo]::SCARD_STATE_PRESENT) -ne 0)
      if ($isPresent) {
        $uid = Get-AtrHex -State $state
        Write-Host "[PCR532] Card already present on '$readerName' ($uid)"
        Send-DemoTap -Uid $uid
      }
    }
  }

  Write-Host "[PCR532] Armed. Waiting for the next card tap..."
  if (-not $DebugReader) {
    Write-Host "[PCR532] Tip: rerun with -DebugReader if taps do not show up."
  }

  $lastHeartbeatAt = Get-Date

  while ($true) {
    for ($i = 0; $i -lt $states.Count; $i++) {
      $state = $states[$i]
      $state.currentState = [PcscDemo]::SCARD_STATE_UNAWARE
      $states[$i] = $state
    }

    $result = [PcscDemo]::SCardGetStatusChange($context, 1000, $states, $states.Count)
    if ($result -eq -2146435062) {
      continue
    }
    if ($result -ne 0) {
      Write-Warning "[PCR532] SCardGetStatusChange failed: 0x$($result.ToString("X8"))"
      Start-Sleep -Seconds 1
      continue
    }

    for ($i = 0; $i -lt $states.Count; $i++) {
      $state = $states[$i]
      $readerName = $state.readerName
      $isPresent = (($state.eventState -band [PcscDemo]::SCARD_STATE_PRESENT) -ne 0)
      $wasPresent = [bool]$presentByReader[$readerName]
      $formattedState = Format-CardState -State $state.eventState

      if ($DebugReader -and $lastStateByReader[$readerName] -ne $state.eventState) {
        Write-Host "[PCR532] State '$readerName': $formattedState"
        if ($state.atrLength -gt 0) {
          Write-Host "[PCR532] ATR: $(Get-AtrHex -State $state)"
        }
      }

      if ($isPresent -and -not $wasPresent) {
        $uid = Get-AtrHex -State $state
        Write-Host "[PCR532] Tap detected on '$readerName' ($uid)"
        Send-DemoTap -Uid $uid
      }

      $presentByReader[$readerName] = $isPresent
      $lastStateByReader[$readerName] = $state.eventState
      $state.currentState = $state.eventState
      $states[$i] = $state
    }

    if ($DebugReader -and ((Get-Date) - $lastHeartbeatAt).TotalSeconds -ge 5) {
      for ($i = 0; $i -lt $states.Count; $i++) {
        $state = $states[$i]
        Write-Host "[PCR532] Still waiting. '$($state.readerName)' is $(Format-CardState -State $state.eventState)"
      }
      $lastHeartbeatAt = Get-Date
    }

    Start-Sleep -Milliseconds 200
  }
} finally {
  [PcscDemo]::SCardReleaseContext($context) | Out-Null
}
