import "./globals.css";

export const metadata = {
  title: "Polymarket Market Explorer",
  description: "Browse and filter active Polymarket prediction markets",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
