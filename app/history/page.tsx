import { redirect } from "next/navigation";

// Old links to the runs list land on Runs.
export default function HistoryPage() {
  redirect("/runs");
}
