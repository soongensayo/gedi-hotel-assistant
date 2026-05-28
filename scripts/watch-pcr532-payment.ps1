param(
  [string]$BackendUrl = "http://localhost:3001/api/checkin/nfc-uid",
  [string]$ReaderNamePattern = "PCR532|SmartCard|Smart Card|Usbccid|CCID|NFC|RFID"
)

$ErrorActionPreference = "Stop"

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PcscDemo {
  public const uint SCARD_SCOPE_SYSTEM = 2;
  public const uint SCARD_STATE_UNAWARE = 0x0000;
  public const uint SCARD_STATE_EMPTY = 0x0010;
  public const uint SCARD_STATE_PRESENT = 0x0020;

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

  [DllImport("winscard.dll", CharSet = CharSet.Unicode)]
  public static extern int SCardListReaders(
    IntPtr context,
    string groups,
    char[] readers,
    ref int readerCount
  );

  [DllImport("winscard.dll")]
  public static extern int SCardGetStatusChange(
    IntPtr context,
    int timeoutMs,
    [In, Out] ReaderState[] readerStates,
    int readerCount
  );

  [DllImport("winscard.dll")]
  public static extern int SCardReleaseContext(IntPtr context);

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
}
"@

function Get-AtrHex {
  param([PcscDemo+ReaderState]$State)

  if ($State.atrLength -le 0) {
    return "532"
  }

  $bytes = $State.atr[0..([int]$State.atrLength - 1)]
  return (($bytes | ForEach-Object { $_.ToString("X2") }) -join "")
}

Write-Host "[PCR532] Watching PC/SC readers. Backend: $BackendUrl"

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

  $states = @($readers | ForEach-Object { [PcscDemo]::NewReaderState($_) })
  $presentByReader = @{}

  while ($true) {
    $result = [PcscDemo]::SCardGetStatusChange($context, 1000, $states, $states.Count)
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

      if ($isPresent -and -not $wasPresent) {
        $uid = Get-AtrHex -State $state
        Write-Host "[PCR532] Tap detected on '$readerName' ($uid)"
        try {
          Invoke-RestMethod `
            -Method Post `
            -Uri $BackendUrl `
            -ContentType "application/json" `
            -Body (@{ uid = $uid } | ConvertTo-Json -Compress) | Out-Null
          Write-Host "[PCR532] Sent tap to backend."
        } catch {
          Write-Warning "[PCR532] Could not notify backend: $($_.Exception.Message)"
        }
      }

      $presentByReader[$readerName] = $isPresent
      $states[$i].currentState = $state.eventState
    }
  }
} finally {
  [PcscDemo]::SCardReleaseContext($context) | Out-Null
}
