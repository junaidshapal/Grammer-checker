import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Grammar Checker",
  description: "Detect and fix English grammar mistakes with AI.",
};

// Inline script that runs before paint to apply the saved theme without a
// flash of the wrong color scheme.
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 antialiased text-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
