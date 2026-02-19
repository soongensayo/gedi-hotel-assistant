export function Footer() {
  return (
    <footer className="border-t border-warm-gray-lighter py-8 mt-auto">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-warm-gray">
        <p>&copy; {new Date().getFullYear()} The Grand Azure Hotel & Residences</p>
        <p className="text-xs">Demo booking portal for AI check-in kiosk</p>
      </div>
    </footer>
  );
}
