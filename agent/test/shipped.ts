import shipped from "../../admin-cli/defaults.json";
import type { DeploymentSettings } from "../src/settings";

/**
 * The values the admin CLI ships a fresh deployment with. The Worker holds none of its
 * own, so tests seed the directory with these (see `setup.ts`) and assert against them.
 */
export const SHIPPED = shipped as unknown as DeploymentSettings;
