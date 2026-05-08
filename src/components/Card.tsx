import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function Card({ children, className = "", title, icon, action }: CardProps) {
  return (
    <section className={`rounded-[18px] border border-blue-100 bg-white p-4 shadow-soft ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-100 text-brand-600">{icon}</div> : null}
            {title ? <h2 className="text-xl font-bold text-slate-950">{title}</h2> : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-blue-200 ${className}`}
    />
  );
}

export function OutlineButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-brand-600 bg-white px-4 py-3 text-base font-bold text-brand-600 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:border-blue-200 disabled:text-blue-200 ${className}`}
    />
  );
}

export function DangerButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-500 bg-white px-4 py-3 text-base font-bold text-red-500 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:border-red-200 disabled:text-red-200 ${className}`}
    />
  );
}

export function StatusBadge({ tone, children }: { tone: "green" | "blue" | "orange" | "red" | "gray"; children: ReactNode }) {
  const styles = {
    green: "border-green-200 bg-green-50 text-green-700",
    blue: "border-blue-200 bg-blue-50 text-brand-600",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    red: "border-red-200 bg-red-50 text-red-600",
    gray: "border-slate-200 bg-slate-50 text-slate-600"
  };
  return <span className={`inline-flex items-center rounded-lg border px-3 py-1 text-sm font-bold ${styles[tone]}`}>{children}</span>;
}
