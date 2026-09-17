import type { Document, Page, Element, Style, BrandKit } from "./model.js";
import { validateDocument } from "./model.js";
export const templates = [
  {
    id: "blank",
    name: "Blank canvas",
    description: "A clean A4 page, ready for your ideas.",
  },
  {
    id: "service-sheet",
    name: "Fieldwork · Service sheet",
    description: "A confident one-page introduction for an independent studio.",
  },
  {
    id: "brochure",
    name: "Gather · Brand brochure",
    description: "Three editorial pages for a thoughtful brand or service.",
  },
  {
    id: "report",
    name: "Signal · Visual report",
    description: "Two pages of clear findings, native charts and next steps.",
  },
];
const id = (kind: string) =>
  `${kind}_${crypto.randomUUID().replaceAll("-", "")}`;
function element(
  type: Element["type"],
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style = {},
  extra: Partial<Element> = {},
): Element {
  return { id: id("el"), type, name, x, y, width, height, style, ...extra };
}
const text = (
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size = 16,
  color = "#233d35",
  extra: Style = {},
) =>
  element(
    "text",
    value.split("\n")[0].slice(0, 60),
    x,
    y,
    w,
    h,
    { fontSize: size, color, lineHeight: 1.45, ...extra },
    { text: value },
  );
const box = (
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  radius = 0,
) =>
  element("shape", name, x, y, w, h, {
    background: color,
    borderRadius: radius,
  });
const line = (x: number, y: number, w: number, color = "#bec8c0") =>
  element("divider", "Rule", x, y, w, 1, { background: color });
const label = (
  value: string,
  x: number,
  y: number,
  w = 650,
  color = "#233d35",
) =>
  text(value, x, y, w, 22, 11, color, { fontWeight: 600, letterSpacing: 1.5 });
const page = (
  name: string,
  elements: Element[],
  background = "#f7f5ef",
): Page => ({
  id: id("page"),
  name,
  width: 794,
  height: 1123,
  background,
  elements,
});
const footer = (name: string, n: string, color = "#63726a") => [
  line(54, 1064, 686, color),
  label(name, 54, 1080, 560, color),
  label(n, 698, 1080, 42, color),
];
function service(): Page[] {
  return [
    page("Your next chapter", [
      box("Evergreen masthead", 0, 0, 794, 478, "#173d32"),
      label("FIELDWORK  /  INDEPENDENT DESIGN STUDIO", 54, 42, 690, "#cde0bd"),
      text("Good ideas.\nBuilt to last.", 54, 116, 488, 186, 58, "#f7f5ef", {
        fontFamily: "Lora",
        lineHeight: 1.13,
      }),
      text(
        "We help ambitious teams turn complex challenges\ninto clear brands, useful products and better experiences.",
        58,
        337,
        460,
        75,
        16,
        "#d5dfd2",
      ),
      box("Orbit outer", 583, 126, 148, 148, "#c6d59e", 80),
      box("Orbit cutout", 615, 158, 84, 84, "#173d32", 44),
      box("Orbit square", 608, 280, 123, 100, "#ec9a68"),
      box("Orbit inner", 608, 280, 63, 50, "#f7f5ef"),
      label("WHAT WE CAN DO TOGETHER", 54, 526),
      text("Clarity at every step.", 54, 563, 686, 52, 34, "#233d35", {
        fontFamily: "Lora",
      }),
      line(54, 644, 686),
      label("01", 54, 666, 50),
      text("Find your focus", 125, 660, 245, 40, 20, "#233d35", {
        fontWeight: 600,
      }),
      text(
        "Research, positioning and a practical\nplan to move your team forward.",
        402,
        663,
        325,
        60,
        15,
        "#596b61",
      ),
      line(54, 746, 686),
      label("02", 54, 768, 50),
      text("Make it meaningful", 125, 762, 260, 40, 20, "#233d35", {
        fontWeight: 600,
      }),
      text(
        "Distinctive identities and thoughtful\nsystems that work in the real world.",
        402,
        765,
        325,
        60,
        15,
        "#596b61",
      ),
      line(54, 848, 686),
      label("03", 54, 870, 50),
      text("Build momentum", 125, 864, 250, 40, 20, "#233d35", {
        fontWeight: 600,
      }),
      text(
        "Launch-ready tools and a clear handoff\nso your next chapter starts strong.",
        402,
        867,
        325,
        60,
        15,
        "#596b61",
      ),
      box("Conversation card", 54, 965, 686, 70, "#e3e8d8", 8),
      text("Have something in mind?", 73, 986, 367, 30, 16, "#233d35", {
        fontWeight: 600,
      }),
      element(
        "text",
        "Start a conversation",
        486,
        986,
        231,
        30,
        { fontSize: 14, color: "#233d35", fontWeight: 600 },
        { text: "Start a conversation →", href: "https://example.com/contact" },
      ),
      ...footer("FIELDWORK  /  SAMPLE SERVICE SHEET", "01"),
    ]),
  ];
}
function brochure(): Page[] {
  return [
    page(
      "A place for what matters",
      [
        label("GATHER", 56, 44, 370, "#782e27"),
        label("SPACES  /  PEOPLE  /  POSSIBILITY", 420, 44, 320, "#782e27"),
        text("A place for\nwhat matters.", 54, 132, 686, 178, 66, "#782e27", {
          fontFamily: "Lora",
          lineHeight: 1.09,
        }),
        text(
          "Thoughtful spaces for working, meeting\nand making something together.",
          58,
          350,
          520,
          72,
          21,
          "#655c52",
        ),
        box("Illustrated courtyard", 54, 471, 686, 446, "#d9c4a9"),
        box("Left architecture", 93, 516, 158, 356, "#f6efe2"),
        box("Tall arch", 271, 554, 183, 318, "#ad6650", 94),
        box("Arch doorway", 302, 628, 121, 244, "#6f352f", 65),
        box("Right architecture", 477, 510, 221, 362, "#edb08c"),
        box("Window", 520, 553, 135, 146, "#f6efe2", 72),
        box("Sun", 565, 755, 86, 86, "#a16d43", 43),
        box("Courtyard line", 94, 872, 604, 3, "#782e27"),
        label("WELCOME TO GATHER", 56, 955, 570, "#782e27"),
        text(
          "Room to think. Space to belong.",
          56,
          987,
          670,
          45,
          25,
          "#782e27",
          { fontFamily: "Lora" },
        ),
        ...footer("GATHER  /  AN ORIGINAL SAMPLE BROCHURE", "01", "#9c7463"),
      ],
      "#f7f1e6",
    ),
    page(
      "Designed around people",
      [
        label("THE GATHER APPROACH", 54, 43, 680, "#782e27"),
        text("Designed around\npeople.", 54, 116, 668, 145, 49, "#782e27", {
          fontFamily: "Lora",
          lineHeight: 1.17,
        }),
        text(
          "The best spaces do more than look good. They make\nit easier to connect, concentrate and feel at home.",
          57,
          296,
          670,
          82,
          20,
          "#655c52",
        ),
        box("Story card", 54, 423, 319, 268, "#e8dac7", 6),
        label("01  /  COMFORT", 76, 449, 264, "#782e27"),
        text("Settle in.", 76, 493, 263, 58, 32, "#782e27", {
          fontFamily: "Lora",
        }),
        text(
          "Natural materials, a quiet corner\nand the details that make the\neveryday feel a little better.",
          76,
          569,
          268,
          87,
          16,
          "#655c52",
        ),
        box("Story card", 395, 423, 345, 268, "#782e27", 6),
        label("02  /  CONNECTION", 417, 449, 300, "#f6dfc9"),
        text("Find your people.", 417, 493, 301, 60, 29, "#fff7ed", {
          fontFamily: "Lora",
        }),
        text(
          "Shared tables, open invitations\nand simple ways to be part\nof something bigger.",
          417,
          569,
          299,
          87,
          16,
          "#f6dfc9",
        ),
        line(54, 746, 686, "#c8ae98"),
        label("03  /  FLEXIBILITY", 54, 777, 230, "#782e27"),
        text(
          "A little room\nfor possibility.",
          54,
          824,
          305,
          107,
          32,
          "#782e27",
          { fontFamily: "Lora", lineHeight: 1.23 },
        ),
        text(
          "A focused morning. A workshop with your\nteam. A conversation that sparks the\nnext idea. Our spaces adapt to the way\nyour day unfolds.",
          400,
          814,
          340,
          141,
          17,
          "#655c52",
        ),
        ...footer("GATHER  /  OUR APPROACH", "02", "#9c7463"),
      ],
      "#f7f1e6",
    ),
    page(
      "Make room for your next idea",
      [
        label("YOUR NEXT CHAPTER", 54, 44, 650, "#782e27"),
        text(
          "Make room for\nyour next idea.",
          54,
          118,
          688,
          146,
          50,
          "#782e27",
          { fontFamily: "Lora", lineHeight: 1.16 },
        ),
        text(
          "Choose a starting point. We will help with the rest.",
          56,
          307,
          680,
          48,
          20,
          "#655c52",
        ),
        element(
          "table",
          "Ways to gather",
          54,
          402,
          686,
          277,
          { fontSize: 16, color: "#655c52", lineHeight: 1.5 },
          {
            cells: [
              ["Come for", "Make it yours", "A good fit for"],
              [
                "A focused day",
                "A desk, a coffee, a fresh start",
                "Independent work",
              ],
              [
                "A shared session",
                "Flexible rooms and useful tools",
                "Teams and workshops",
              ],
              [
                "A new connection",
                "Events, ideas and conversation",
                "Curious minds",
              ],
            ],
          },
        ),
        box("Invitation", 54, 730, 686, 274, "#782e27", 8),
        label("COME SAY HELLO", 81, 759, 620, "#f1cbb3"),
        text("The door is open.", 81, 807, 627, 69, 39, "#fff7ed", {
          fontFamily: "Lora",
        }),
        text(
          "Bring your questions. Tell us what you have in mind.\nLet us find a space that feels right.",
          81,
          887,
          620,
          61,
          17,
          "#f6dfc9",
        ),
        element(
          "text",
          "Plan a visit",
          81,
          964,
          620,
          29,
          { fontSize: 15, fontWeight: 600, color: "#fff7ed" },
          {
            text: "Plan a visit →  example.com/gather",
            href: "https://example.com/gather",
          },
        ),
        ...footer("GATHER  /  LET US MAKE SOMETHING TOGETHER", "03", "#9c7463"),
      ],
      "#f7f1e6",
    ),
  ];
}
function report(): Page[] {
  return [
    page(
      "A clearer view of progress",
      [
        label("SIGNAL  /  QUARTERLY FIELD NOTES", 54, 43, 580, "#4b4474"),
        label("EXAMPLE DATA", 609, 43, 135, "#77708c"),
        text("A clearer view\nof progress.", 54, 119, 688, 139, 51, "#30274e", {
          fontFamily: "Lora",
          lineHeight: 1.15,
        }),
        text(
          "A visual report on the habits, systems and small\nchanges that help a growing team do its best work.",
          57,
          302,
          670,
          76,
          20,
          "#6c6679",
        ),
        box("Highlight background", 54, 419, 686, 166, "#ece8f4", 8),
        label("THIS QUARTER, AT A GLANCE", 77, 441, 630, "#625087"),
        text("82%", 77, 480, 190, 63, 43, "#4b3a70", { fontWeight: 600 }),
        text("+16 pts", 293, 480, 210, 63, 43, "#4b3a70", { fontWeight: 600 }),
        text("04", 558, 480, 130, 63, 43, "#4b3a70", { fontWeight: 600 }),
        text("Team confidence", 79, 548, 194, 23, 13, "#6c6679"),
        text("Since the baseline", 295, 548, 240, 23, 13, "#6c6679"),
        text("Focused experiments", 558, 548, 175, 23, 13, "#6c6679"),
        label("A STEADIER RHYTHM", 54, 640, 686, "#4b4474"),
        text(
          "Confidence grew with consistency.",
          54,
          674,
          680,
          42,
          26,
          "#30274e",
          { fontFamily: "Lora" },
        ),
        box("Chart baseline", 98, 939, 611, 1, "#bcb4cb"),
        box("Month 1 bar", 132, 828, 118, 111, "#c3b7d7", 4),
        box("Month 2 bar", 316, 779, 118, 160, "#9381b4", 4),
        box("Month 3 bar", 500, 726, 118, 213, "#625087", 4),
        text("58%", 136, 794, 110, 30, 19, "#4b3a70", {
          fontWeight: 600,
          textAlign: "center",
        }),
        text("69%", 320, 745, 110, 30, 19, "#4b3a70", {
          fontWeight: 600,
          textAlign: "center",
        }),
        text("82%", 504, 692, 110, 30, 19, "#4b3a70", {
          fontWeight: 600,
          textAlign: "center",
        }),
        text("MONTH 1", 128, 958, 132, 30, 11, "#6c6679", {
          letterSpacing: 1,
          textAlign: "center",
        }),
        text("MONTH 2", 312, 958, 132, 30, 11, "#6c6679", {
          letterSpacing: 1,
          textAlign: "center",
        }),
        text("MONTH 3", 496, 958, 132, 30, 11, "#6c6679", {
          letterSpacing: 1,
          textAlign: "center",
        }),
        text(
          "Illustrative sample only. Confidence score from a fictional monthly team pulse.",
          54,
          1011,
          686,
          24,
          11,
          "#8b8498",
        ),
        ...footer("SIGNAL  /  QUARTERLY REPORT", "01", "#8b8498"),
      ],
      "#fcfbfe",
    ),
    page(
      "What to do next",
      [
        label("FROM INSIGHT TO ACTION", 54, 43, 686, "#4b4474"),
        text(
          "Keep the useful.\nImprove the rest.",
          54,
          116,
          686,
          150,
          49,
          "#30274e",
          { fontFamily: "Lora", lineHeight: 1.16 },
        ),
        text(
          "Three practical moves for the next quarter.",
          56,
          301,
          670,
          48,
          20,
          "#6c6679",
        ),
        line(54, 396, 686, "#d6cfdf"),
        label("01", 54, 423, 48, "#625087"),
        text("Protect the focus.", 125, 413, 610, 45, 25, "#30274e", {
          fontFamily: "Lora",
        }),
        text(
          "Keep two meeting-free blocks each week. Make room for\ndeep work before adding another process or tool.",
          125,
          472,
          610,
          65,
          16,
          "#6c6679",
        ),
        line(54, 568, 686, "#d6cfdf"),
        label("02", 54, 595, 48, "#625087"),
        text("Make decisions visible.", 125, 585, 610, 45, 25, "#30274e", {
          fontFamily: "Lora",
        }),
        text(
          "Record the decision, the owner and the next step in one place.\nA short shared note can replace a long chain of follow-ups.",
          125,
          644,
          610,
          65,
          16,
          "#6c6679",
        ),
        line(54, 740, 686, "#d6cfdf"),
        label("03", 54, 767, 48, "#625087"),
        text("Build a feedback rhythm.", 125, 757, 610, 45, 25, "#30274e", {
          fontFamily: "Lora",
        }),
        text(
          "Ask one useful question every fortnight. Share what changed\nand close the loop with the people who helped you see it.",
          125,
          816,
          610,
          65,
          16,
          "#6c6679",
        ),
        box("Next review", 54, 944, 686, 93, "#ece8f4", 7),
        label("NEXT REVIEW", 76, 960, 167, "#625087"),
        text(
          "Choose one experiment. Give it four weeks.\nLook for progress you can explain.",
          257,
          965,
          455,
          53,
          16,
          "#4b3a70",
        ),
        ...footer("SIGNAL  /  ACTION PLAN", "02", "#8b8498"),
      ],
      "#fcfbfe",
    ),
  ];
}
export function createDocument(name: string, template = "blank"): Document {
  if (!templates.some((t) => t.id === template))
    throw new Error(`Unknown template: ${template}`);
  const now = new Date().toISOString();
  const brand: BrandKit = {
    id: id("brand"),
    name:
      template === "brochure"
        ? "Gather"
        : template === "report"
          ? "Signal"
          : "Fieldwork",
    colors: {
      primary:
        template === "report"
          ? "#625087"
          : template === "brochure"
            ? "#782e27"
            : "#173d32",
      paper:
        template === "brochure"
          ? "#f7f1e6"
          : template === "report"
            ? "#fcfbfe"
            : "#f7f5ef",
      accent:
        template === "brochure"
          ? "#edb08c"
          : template === "report"
            ? "#c3b7d7"
            : "#ec9a68",
    },
    fonts: { heading: "Lora", body: "Inter" },
    components: [],
  };
  return validateDocument({
    schemaVersion: 1,
    rendererVersion: 1,
    id: id("doc"),
    name,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    brand,
    assets: {},
    comments: [],
    pages:
      template === "service-sheet"
        ? service()
        : template === "brochure"
          ? brochure()
          : template === "report"
            ? report()
            : [page("Page 1", [], "#ffffff")],
  });
}
