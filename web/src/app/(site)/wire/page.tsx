import type { Metadata } from "next";
import { WireView } from "@/components/WireView";

export const metadata: Metadata = { title: "The Wire" };

export default function Page() {
  return <WireView />;
}
