const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_SIZE = 400;
const CENTER = VIEW_SIZE / 2;
const RING_RADIUS = 140;
const RIM_RADIUS = 184;
const CENTER_SCALE = 1.25;
const HALO_EXTRA = 10;
const GUIDE_ROLES = { now: 1, next: 2, after: 3 };
const BADGE_X = 20.5;
const BADGE_Y = -10;

const TONGUE_GEOMETRY = {
  big: { radius: 44, crown: -50, leg: 32, stroke: 15 },
  middle: { radius: 27, crown: -20, leg: 28, stroke: 15 },
  small: { radius: 12, crown: 10, leg: 32, stroke: 14 },
};

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function groupTongues(layout) {
  const groups = [];
  const byName = new Map();

  layout.tongues.forEach((tongue, index) => {
    let group = byName.get(tongue.groupName);
    if (!group) {
      group = { name: tongue.groupName, tongues: [] };
      byName.set(tongue.groupName, group);
      groups.push(group);
    }
    group.tongues.push({ tongue, index });
  });

  return groups;
}

function groupPlacement(groupIndex, groupCount) {
  if (groupIndex === 0) {
    return { x: CENTER, y: CENTER, rotation: 0, scale: CENTER_SCALE };
  }

  const ringCount = groupCount - 1;
  const angle = -90 + ((groupIndex - 1) * 360) / ringCount;
  const radians = (angle * Math.PI) / 180;

  return {
    x: CENTER + RING_RADIUS * Math.cos(radians),
    y: CENTER + RING_RADIUS * Math.sin(radians),
    rotation: angle - 90,
    scale: 1,
  };
}

function archPath(geometry) {
  const arcCenter = geometry.crown + geometry.radius;
  return [
    `M ${-geometry.radius} ${geometry.leg}`,
    `L ${-geometry.radius} ${arcCenter}`,
    `A ${geometry.radius} ${geometry.radius} 0 0 1 ${geometry.radius} ${arcCenter}`,
    `L ${geometry.radius} ${geometry.leg}`,
  ].join(" ");
}

function crownPosition(placement, crown) {
  const radians = (placement.rotation * Math.PI) / 180;
  return {
    x: placement.x - crown * Math.sin(radians) * placement.scale,
    y: placement.y + crown * Math.cos(radians) * placement.scale,
  };
}

function ariaLabel(tongue, slot, active, role) {
  const state = slot === null ? "Waiting" : slot.label;
  if (!active) return `${tongue.label}. ${state}.`;
  if (role === "now") return `${tongue.label}. ${state}. Play this note now.`;
  if (role === "next") return `${tongue.label}. ${state}. Up next.`;
  if (role === "after") return `${tongue.label}. ${state}. Coming after next.`;
  return `${tongue.label}. ${state}. Next to play.`;
}

export function createDrumView(layout, session, options = {}) {
  const groups = groupTongues(layout);
  const tongueElements = new Array(layout.tongues.length);
  const noteElements = new Array(layout.tongues.length);
  const badgeElements = new Array(layout.tongues.length);
  const badgeTextElements = new Array(layout.tongues.length);
  let guideRoles = null;

  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`,
    class: "drum-svg",
    role: "group",
    "aria-label": layout.name,
  });

  svg.append(
    createSvgElement("circle", {
      class: "drum-rim",
      cx: CENTER,
      cy: CENTER,
      r: RIM_RADIUS,
    }),
  );

  const labels = createSvgElement("g", {
    class: "drum-labels",
    "aria-hidden": "true",
  });

  const badges = createSvgElement("g", {
    class: "drum-badges",
    "aria-hidden": "true",
  });

  groups.forEach((group, groupIndex) => {
    const placement = groupPlacement(groupIndex, groups.length);
    const groupElement = createSvgElement("g", {
      class: "drum-group",
      transform: `translate(${placement.x} ${placement.y}) rotate(${placement.rotation}) scale(${placement.scale})`,
    });

    for (const { tongue, index } of group.tongues) {
      const geometry = TONGUE_GEOMETRY[tongue.size];
      const path = archPath(geometry);

      const tongueElement = createSvgElement("g", {
        class: "drum-tongue pending",
        "data-index": index,
        tabindex: "0",
        focusable: "true",
        role: "button",
        "aria-label": ariaLabel(tongue, null, false, null),
      });

      tongueElement.append(
        createSvgElement("path", {
          class: "tongue-halo",
          d: path,
          "stroke-width": geometry.stroke + HALO_EXTRA,
        }),
        createSvgElement("path", {
          class: "tongue-band",
          d: path,
          "stroke-width": geometry.stroke,
        }),
      );

      groupElement.append(tongueElement);
      tongueElements[index] = tongueElement;

      const crown = crownPosition(placement, geometry.crown);
      const note = createSvgElement("text", {
        class: "tongue-note",
        x: crown.x.toFixed(2),
        y: crown.y.toFixed(2),
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      noteElements[index] = note;
      labels.append(note);

      const badgeX = (crown.x + BADGE_X).toFixed(2);
      const badgeY = (crown.y + BADGE_Y).toFixed(2);
      const badge = createSvgElement("g", {
        class: "guide-badge hidden",
        "data-index": index,
        transform: `translate(${badgeX} ${badgeY})`,
      });
      const badgeText = createSvgElement("text", {
        class: "guide-badge-text",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      badge.append(
        createSvgElement("circle", {
          class: "guide-badge-disc",
          r: 9.5,
        }),
        badgeText,
      );
      badgeElements[index] = badge;
      badgeTextElements[index] = badgeText;
      badges.append(badge);
    }

    svg.append(groupElement);
  });

  svg.append(labels, badges);

  function update() {
    const guided = guideRoles !== null;
    layout.tongues.forEach((tongue, index) => {
      const slot = session.slots[index];
      const role = guided ? (guideRoles.get(index) || null) : null;
      const active = guided ? role !== null : session.activeSlot === index;
      const element = tongueElements[index];
      const badge = badgeElements[index];

      element.classList.toggle("pending", slot === null);
      element.classList.toggle("done", slot !== null);
      element.classList.toggle("active", active);
      element.classList.toggle("guide-now", role === "now");
      element.classList.toggle("guide-next", role === "next");
      element.classList.toggle("guide-after", role === "after");
      element.setAttribute("aria-label", ariaLabel(tongue, slot, active, role));

      const current = guided ? role === "now" : active;
      if (current) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");

      noteElements[index].textContent = slot === null ? "" : slot.label;

      badge.classList.toggle("hidden", role === null);
      badge.classList.toggle("guide-badge-now", role === "now");
      badge.classList.toggle("guide-badge-next", role === "next");
      badge.classList.toggle("guide-badge-after", role === "after");
      badgeTextElements[index].textContent =
        role === null ? "" : String(GUIDE_ROLES[role]);
    });
  }

  function setGuideLookahead(lookahead) {
    if (lookahead === null) {
      guideRoles = null;
    } else {
      guideRoles = new Map();
      for (const role of ["now", "next", "after"]) {
        for (const index of lookahead[role] || []) {
          if (!guideRoles.has(index)) guideRoles.set(index, role);
        }
      }
    }
    update();
  }

  function activate(index) {
    if (guideRoles !== null) return;
    session.selectSlot(index);
    update();
    if (typeof options.onSelect === "function") options.onSelect(index);
  }

  svg.addEventListener("click", (event) => {
    const element = event.target.closest(".drum-tongue");
    if (!element) return;
    activate(Number(element.dataset.index));
  });

  svg.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const element = event.target.closest(".drum-tongue");
    if (!element) return;
    event.preventDefault();
    activate(Number(element.dataset.index));
  });

  update();

  return { element: svg, update, setGuideLookahead };
}
