'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The header nav. The current route is marked for assistive technology
 * (`aria-current="page"`) and visibly, with a rule under the label. Every
 * target is at least 40px tall, and the list wraps rather than colliding with
 * the wordmark at phone width.
 */
const ITEMS = [
  { href: '/assess', label: 'New assessment' },
  { href: '/methodology', label: 'Methodology' },
] as const;

const ITEM = 'inline-flex min-h-10 items-center border-b-2 px-2 text-xs transition';

export function Nav({ controlUrl }: { controlUrl: string }) {
  const pathname = usePathname() ?? '/';
  return (
    <nav aria-label="Main" className="-mx-2">
      <ul className="flex flex-wrap items-center gap-x-2">
        {ITEMS.map((item) => {
          const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={
                  ITEM +
                  (current
                    ? ' border-signal font-medium text-ink-100'
                    : ' border-transparent text-ink-300 hover:text-ink-100')
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
        <li>
          {/* A separate product: an ordinary link out, never marked current. */}
          <a href={controlUrl} className={ITEM + ' border-transparent text-ink-300 hover:text-ink-100'}>
            ARK Control
          </a>
        </li>
      </ul>
    </nav>
  );
}
