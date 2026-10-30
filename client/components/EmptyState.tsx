import { ReactNode } from "react";
import { Link } from "react-router-dom";

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 bg-ink/[.015] px-6 py-12 text-center">
      {icon && <div className="mx-auto grid size-12 place-items-center rounded-full bg-secondary text-coral">{icon}</div>}
      <h3 className="mt-4 font-display text-xl font-semibold tracking-[-.02em]">{title}</h3>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink/50">{description}</p>}
      {actionLabel && actionTo && <Link to={actionTo} className="button button-dark mt-6">{actionLabel}</Link>}
      {actionLabel && onAction && <button type="button" onClick={onAction} className="button button-dark mt-6">{actionLabel}</button>}
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
