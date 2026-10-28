import type { Metadata } from "next";
import { DeskView } from "@/components/DeskView";

export const metadata: Metadata = { title: "The Desk" };

export default function Page() {
  return <DeskView />;
}
