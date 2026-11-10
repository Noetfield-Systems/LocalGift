import { test, expect } from "bun:test";
import { BASELINE_DDL } from "../src/db/baseline";
import { existsSync, readFileSync } from "node:fs";
test("baseline preserves the original three tables",()=>{expect(BASELINE_DDL).toHaveLength(3);for(const table of ["localgift_interest","localgift_merchant_leads","localgift_partners"])expect(BASELINE_DDL.some(s=>s.includes(table))).toBe(true);});
test("separated original web documents are nonempty",()=>{for(const name of ["home","operator","privacy","terms"]){const f="src/pages/"+name+".html";expect(existsSync(f)).toBe(true);expect(readFileSync(f,"utf8")).toContain("<html");}});
