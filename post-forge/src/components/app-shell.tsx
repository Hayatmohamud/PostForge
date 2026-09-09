"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AppShellProps = { children: ReactNode };

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const mainContent = document.getElementById("main-content");
          mainContent?.focus();
          mainContent?.scrollIntoView();
          window.history.replaceState(null, "", "#main-content");
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="PostForge home">
            <span className="brand-mark" aria-hidden="true">P</span>
            <span>PostForge</span>
          </Link>
          <nav className="primary-nav" aria-label="Primary navigation">
            <Link className="nav-link" href="/" aria-current={pathname === "/" ? "page" : undefined}>New Post</Link>
            <Link className="nav-link" href="/library" aria-current={pathname.startsWith("/library") ? "page" : undefined}>Library</Link>
          </nav>
        </div>
      </header>
      <div className="app-content" id="main-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
