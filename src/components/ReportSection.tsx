import type { ReactNode } from "react";
import { Card } from "./Card";

export function ReportSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card title={title} action={action}>
      {children}
    </Card>
  );
}
