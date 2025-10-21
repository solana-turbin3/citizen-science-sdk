export const metadata = {
  title: 'Citizen Science – Photo Verifier',
  description: 'Images grouped by Seeker device with metadata',
};

import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <h1>Citizen Science – Photo Verifier</h1>
            <p className="subtitle">Images grouped by Seeker device, with hash and optional proof</p>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}


