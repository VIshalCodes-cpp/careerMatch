import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  const window = 1;
  const numbers: (number | "…")[] = [];
  for (let index = 1; index <= pages; index++) {
    if (index === 1 || index === pages || Math.abs(index - page) <= window) numbers.push(index);
    else if (numbers[numbers.length - 1] !== "…") numbers.push("…");
  }

  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="grid size-9 place-items-center rounded-lg border border-ink/10 text-ink/50 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      {numbers.map((item, index) =>
        item === "…" ? (
          <span key={`gap-${index}`} className="px-1 text-sm text-ink/35">…</span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            aria-current={item === page ? "page" : undefined}
            className={`grid size-9 place-items-center rounded-lg border text-sm transition-colors ${item === page ? "border-ink bg-ink text-paper" : "border-ink/10 text-ink/55 hover:border-ink/30 hover:text-ink"}`}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
        className="grid size-9 place-items-center rounded-lg border border-ink/10 text-ink/50 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
