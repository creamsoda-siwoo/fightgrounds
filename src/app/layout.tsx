import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FIGHTGROUNDS — 3D 배틀로얄',
  description: '브라우저에서 즐기는 3D 배틀로얄. 40명이 폭풍이 조여 오는 섬에 강하해 마지막 한 명이 남을 때까지 싸웁니다.',
};

export const viewport: Viewport = {
  themeColor: '#0b0f14',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
