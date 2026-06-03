import type { ReactNode } from 'react';

// Small theme-native atoms that reuse the existing marketplace.css classes,
// so styling is identical to the previous webview.

export function Button(props: {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'external';
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  children: ReactNode;
}): JSX.Element {
  const cls = `btn btn-${props.variant ?? 'primary'}`;
  return (
    <button className={cls} title={props.title} disabled={props.disabled} style={props.style} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function Tag({ children, official }: { children: ReactNode; official?: boolean }): JSX.Element {
  return <span className={`tag${official ? ' tag--official' : ''}`}>{children}</span>;
}

export function TypeBadge({ type, label }: { type: string; label?: string }): JSX.Element {
  return <span className={`asset-type-badge asset-type-badge--${type}`}>{label ?? type}</span>;
}

export function EmptyState({ children, inline }: { children: ReactNode; inline?: boolean }): JSX.Element {
  return <div className={`mp-empty${inline ? ' mp-empty--inline' : ''}`}>{children}</div>;
}

export function Loading({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mp-loading">{children}</div>;
}
