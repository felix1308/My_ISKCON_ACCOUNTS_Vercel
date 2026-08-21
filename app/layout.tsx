import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "MyISKCON Accounts",
  description: "Temple Donation Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://checkout.razorpay.com/v1/checkout.js" async />
        <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" async />
      </head>
      <body className="h-full bg-theme-page">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
