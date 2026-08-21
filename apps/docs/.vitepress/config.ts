import { defineConfig } from "vitepress";

export default defineConfig({
  title: "pg-access",
  description:
    "A type-safe, declarative way to define PostgreSQL Row-Level Security. Compiles to real SQL, not a runtime layer.",
  cleanUrls: true,
  srcDir: ".",
  srcExclude: ["README.md"],
  // This is a GitHub Pages *project* site (github.com/JonasDias10/pg-access),
  // served at jonasdias10.github.io/pg-access/, not at the domain root; every
  // asset/link breaks in production without this matching that subpath.
  base: "/pg-access/",

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI", link: "/cli/" },
      { text: "Testing", link: "/testing/" },
      { text: "Reference", link: "/reference/" },
      { text: "Roadmap", link: "/roadmap" },
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
      {
        text: "Project",
        items: [{ text: "Roadmap", link: "/roadmap" }],
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
