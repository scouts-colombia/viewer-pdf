import { bindings, defineConfig } from "cf/config";

// Misma configuración que tenía el Worker cuando se editaba desde el dashboard.
export default defineConfig({
	worker: {
		name: "r2-download-cleaner",
		compatibilityDate: "2026-03-30",
		entrypoint: "./worker.js",
		env: {
			MY_BUCKET: bindings.r2({ name: "scouts-cdn" }),
		},
		domains: ["biblioteca.cdnscout.org"],
		workersDev: true,
		previewUrls: false,
		observability: {
			enabled: true,
			headSamplingRate: 1,
			logs: { enabled: true, headSamplingRate: 1, invocationLogs: true },
		},
	},
});
