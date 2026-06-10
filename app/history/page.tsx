import { redirect } from "next/navigation";

// v2 merges the runs list into Home — /history just forwards there so old
// links and muscle memory keep working.
export default function HistoryPage() {
  redirect("/");
}
