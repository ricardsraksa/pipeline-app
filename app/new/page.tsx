import { redirect } from "next/navigation";

// New runs start from the top of Runs.
export default function NewRedirect() {
  redirect("/runs");
}
