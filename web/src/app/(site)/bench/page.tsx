import type { Metadata } from "next";
import { BenchView } from "@/components/BenchView";

export const metadata: Metadata = { title: "The Bench" };

export default function Page() {
  return <BenchView />;
}
