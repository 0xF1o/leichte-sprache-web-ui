import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Umgebungsvariablen ohne VITE_-Präfix: LSWUI_… wird an die App übergeben
  envPrefix: "LSWUI_",
});
