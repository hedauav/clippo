import type { Metadata } from "next";
import { ChainProfileView } from "@/components/ModulePages";

export const metadata: Metadata = { title: "On-chain profile" };

export default function Page() {
  return <ChainProfileView />;
}
