export function Block({ id, title, children, wide }: { id?: string; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section id={id} className="grid gap-5 border-b border-hairline py-10">
      <h2 className="eyebrow font-normal">{title}</h2>
      <div className={wide ? "grid min-w-0 gap-4" : "flex flex-wrap items-start gap-4"}>{children}</div>
    </section>
  );
}
