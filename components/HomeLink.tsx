"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header link to the Matches landing page. When already on it, a click
 *  recenters the timeline on today (top of viewport) instead of no-op'ing. */
export default function HomeLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onClick = (e: React.MouseEvent) => {
    if (pathname !== "/") return; // let normal navigation happen
    const anchor = document.getElementById("today-anchor");
    if (anchor) {
      e.preventDefault();
      anchor.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };
  return (
    <Link href="/" className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
