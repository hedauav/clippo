import type { Metadata } from "next";
import { BriefBuilder } from "@/components/workspace/BriefBuilder";

export const metadata: Metadata = { title: "Write the brief" };

export default function Page() {
  return <BriefBuilder />;
}
