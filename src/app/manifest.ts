import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tribe Harbor Phone",
    short_name: "Tribe Phone",
    description: "Trifecta Benefits calling and messaging",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f6f8",
    theme_color: "#0a7aff",
    orientation: "any",
    categories: ["business", "communication", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
