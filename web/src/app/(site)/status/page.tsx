import type { Metadata } from "next";
import { StatusView } from "@/components/ModulePages";

export const metadata: Metadata = { title: "Status ladder" };

export default function Page() {
  return <StatusView />;
}
