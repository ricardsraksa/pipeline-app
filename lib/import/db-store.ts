// The Import store bound to the app's database (tests bind their own).
import { db } from "@/lib/db";
import { createImportStore } from "@/lib/import/store";

export const importStore = createImportStore(db);
