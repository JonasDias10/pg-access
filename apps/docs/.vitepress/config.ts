import { defineConfig } from "vitepress";

// This is a GitHub Pages *project* site (github.com/JonasDias10/pg-access),
// served at jonasdias10.github.io/pg-access/, not at the domain root; every
// asset/link breaks in production without this matching that subpath. Raw
// `head` tags aren't base-rewritten by VitePress the way themeConfig image
// paths are, so the favicon href below prepends it manually.
const base = "/pg-access/";

export default defineConfig({
  title: "pg-access",
  description:
    "A type-safe, declarative way to define PostgreSQL Row-Level Security. Compiles to real SQL, not a runtime layer.",
  cleanUrls: true,
  srcDir: ".",
  srcExclude: ["README.md"],
  base,
  head: [
    ["link", { rel: "icon", type: "image/png", href: `${base}favicon.png` }],
    [
      "meta",
      { property: "og:image", content: "https://jonasdias10.github.io/pg-access/pg-access.png" },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],

  themeConfig: {
    logo: { light: "/pg-access-icon.png", dark: "/pg-access-icon-dark.png", alt: "pg-access" },
    siteTitle: false,

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI", link: "/cli/" },
      { text: "Testing", link: "/testing/" },
      { text: "Reference", link: "/reference/" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "The DSL", link: "/guide/the-dsl" },
          { text: "USING vs WITH CHECK", link: "/guide/using-vs-with-check" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Security", link: "/guide/security" },
        ],
      },
      {
        text: "CLI",
        items: [{ text: "init / generate / check", link: "/cli/" }],
      },
      {
        text: "Testing",
        items: [{ text: "@pg-access/testing", link: "/testing/" }],
      },
      {
        text: "Reference",
        items: [{ text: "API reference", link: "/reference/" }],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/JonasDias10/pg-access" }],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/JonasDias10/pg-access/edit/main/apps/docs/:path",
    },
  },
});
