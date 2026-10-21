const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_SIZE = 400;
const CENTER = VIEW_SIZE / 2;
const RING_RADIUS = 140;
const RIM_RADIUS = 184;
const CENTER_SCALE = 1.25;
const HALO_EXTRA = 10;
const BADGE_HEIGHT = 24;
const BADGE_PADDING = 12;
const BADGE_CLEARANCE = 16;
const BADGE_ABOVE = 24;
const BADGE_EDGE = 4;

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

function ariaLabel(tongue, slot, active, numbers = []) {
  const state = slot === null ? "Waiting" : slot.label;
  const base = `${tongue.label}. ${state}.`;
  if (numbers.includes(1)) {
    const others = numbers.filter((number) => number !== 1);
    const extra = others.length
      ? `, also step${others.length === 1 ? "" : "s"} ${others.join(" and ")}`
      : "";
    return `${base} Play this note now${extra}.`;
  }
  if (numbers.includes(2)) {
    return `${base} Up next${numbers.includes(3) ? ", also step 3" : ""}.`;
  }
  if (numbers.includes(3)) return `${base} Coming after next.`;
  if (!active) return base;
  return `${base} Next to play.`;
}

export function createDrumView(layout, session, options = {}) {
  const groups = groupTongues(layout);
  const tongueElements = new Array(layout.tongues.length);
  const noteElements = new Array(layout.tongues.length);
  const badgeElements = new Array(layout.tongues.length);
  const badgePillElements = new Array(layout.tongues.length);
  const badgeTextElements = new Array(layout.tongues.length);
  const badgeAnchors = new Array(layout.tongues.length);
  let guideNumbers = null;

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
        "aria-label": ariaLabel(tongue, null, false, []),
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

      const badge = createSvgElement("g", {
        class: "guide-badge hidden",
        "data-index": index,
      });
      const badgePill = createSvgElement("rect", {
        class: "guide-badge-pill",
        x: 0,
        y: -BADGE_HEIGHT / 2,
        width: 0,
        height: BADGE_HEIGHT,
        rx: BADGE_HEIGHT / 2,
        ry: BADGE_HEIGHT / 2,
      });
      const badgeText = createSvgElement("text", {
        class: "guide-badge-text",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      badge.append(badgePill, badgeText);
      badgeElements[index] = badge;
      badgePillElements[index] = badgePill;
      badgeTextElements[index] = badgeText;
      badgeAnchors[index] = { x: crown.x, y: crown.y };
      badges.append(badge);
    }

    svg.append(groupElement);
  });

  svg.append(labels, badges);

  function update() {
    const guided = guideNumbers !== null;
    layout.tongues.forEach((tongue, index) => {
      const slot = session.slots[index];
      const numbers = guided ? (guideNumbers.get(index) || []) : [];
      const active = guided ? numbers.includes(1) : session.activeSlot === index;
      const element = tongueElements[index];
      const badge = badgeElements[index];
      const pill = badgePillElements[index];
      const badgeText = badgeTextElements[index];

      element.classList.toggle("pending", slot === null);
      element.classList.toggle("done", slot !== null);
      element.classList.toggle("active", active);
      element.classList.toggle("guide-current", guided && active);
      element.setAttribute("aria-label", ariaLabel(tongue, slot, active, numbers));

      if (active) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");

      noteElements[index].textContent = slot === null ? "" : slot.label;

      const visible = numbers.length > 0;
      badge.classList.toggle("hidden", !visible);
      badgeText.textContent = visible ? numbers.join(" · ") : "";
      if (visible) {
        const measured = badgeText.getComputedTextLength();
        const width =
          (measured > 0 ? measured : badgeText.textContent.length * 8) + BADGE_PADDING;
        pill.setAttribute("x", String(-width / 2));
        pill.setAttribute("width", String(width));

        const anchor = badgeAnchors[index];
        let x = anchor.x + BADGE_CLEARANCE + width / 2;
        let y = anchor.y;
        if (x + width / 2 > VIEW_SIZE - BADGE_EDGE) {
          x = Math.min(anchor.x, VIEW_SIZE - width / 2 - BADGE_EDGE);
          y = anchor.y - BADGE_ABOVE;
        }
        badge.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      }
    });
  }

  function setGuideLookahead(steps) {
    if (steps === null) {
      guideNumbers = null;
    } else {
      guideNumbers = new Map();
      steps.forEach((indices, stepIndex) => {
        for (const index of indices || []) {
          if (!guideNumbers.has(index)) guideNumbers.set(index, []);
          const numbers = guideNumbers.get(index);
          if (!numbers.includes(stepIndex + 1)) numbers.push(stepIndex + 1);
        }
      });
    }
    update();
  }

  function activate(index) {
    if (guideNumbers !== null) return;
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
