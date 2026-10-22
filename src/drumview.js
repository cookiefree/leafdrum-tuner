const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_SIZE = 400;
const CENTER = VIEW_SIZE / 2;
const RING_RADIUS = 140;
const RIM_RADIUS = 184;
const CENTER_SCALE = 1.25;
const HALO_EXTRA = 10;
const BADGE_LINE_HEIGHT = 14;
const BADGE_PADDING_X = 8;
const BADGE_PADDING_Y = 4;
const BADGE_NUMBER_GAP = 6;
const BADGE_MAX_CONTENT_WIDTH = 52;
const BADGE_CHAR_WIDTH = 7.5;
const BADGE_CLEARANCE = 20;
const BADGE_LABEL_CLEARANCE = 14;
const BADGE_EDGE = 4;
const BADGE_RADIUS = 9;

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

function ariaLabel(tongue, slot, active, numbers = [], currentNumber = null) {
  const state = slot === null ? "Waiting" : slot.label;
  const base = `${tongue.label}. ${state}.`;
  if (numbers.length === 0) return active ? `${base} Next to play.` : base;

  const steps = numbers.length === 1 ? `step ${numbers[0]}` : `steps ${numbers.join(", ")}`;
  if (currentNumber !== null && numbers.includes(currentNumber)) {
    return `${base} ${steps}. Play step ${currentNumber} now.`;
  }
  if (currentNumber === null) return `${base} ${steps}. Guide finished.`;
  const next = numbers.find((number) => number > currentNumber);
  if (next !== undefined) return `${base} ${steps}. Next step ${next}.`;
  return `${base} ${steps}. Already played.`;
}

export function createDrumView(layout, session, options = {}) {
  const groups = groupTongues(layout);
  const tongueElements = new Array(layout.tongues.length);
  const noteElements = new Array(layout.tongues.length);
  const badgeElements = new Array(layout.tongues.length);
  const badgePillElements = new Array(layout.tongues.length);
  const badgeTextElements = new Array(layout.tongues.length);
  const badgeNumberElements = new Array(layout.tongues.length);
  const badgeAnchors = new Array(layout.tongues.length);
  let guideNumbers = null;
  let guideCurrent = null;

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
        y: 0,
        width: 0,
        height: 0,
        rx: BADGE_RADIUS,
        ry: BADGE_RADIUS,
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
      badgeNumberElements[index] = [];
      badgeAnchors[index] = { x: crown.x, y: crown.y };
      badges.append(badge);
    }

    svg.append(groupElement);
  });

  svg.append(labels, badges);

  function numberState(number) {
    if (guideCurrent === null) return "played";
    if (number === guideCurrent) return "current";
    return number < guideCurrent ? "played" : "future";
  }

  function applyNumberState(item) {
    item.tspan.setAttribute("class", `guide-number guide-number-${numberState(item.number)}`);
  }

  function layoutBadge(index, numbers) {
    const badge = badgeElements[index];
    const pill = badgePillElements[index];
    const text = badgeTextElements[index];
    const anchor = badgeAnchors[index];
    text.replaceChildren();
    badgeNumberElements[index] = [];

    if (numbers.length === 0) {
      badge.classList.add("hidden");
      pill.setAttribute("width", "0");
      pill.setAttribute("height", "0");
      badge.removeAttribute("transform");
      return;
    }

    badge.classList.remove("hidden");

    const items = numbers.map((number) => {
      const tspan = createSvgElement("tspan", {
        x: 0,
        y: 0,
        class: "guide-number guide-number-current",
      });
      tspan.textContent = String(number);
      text.append(tspan);
      const measured = tspan.getComputedTextLength();
      return {
        number,
        tspan,
        width: measured > 0 ? measured : String(number).length * BADGE_CHAR_WIDTH,
      };
    });

    const lines = [];
    let line = [];
    let lineWidth = 0;
    for (const item of items) {
      const nextWidth = line.length === 0 ? item.width : lineWidth + BADGE_NUMBER_GAP + item.width;
      if (line.length > 0 && nextWidth > BADGE_MAX_CONTENT_WIDTH) {
        lines.push({ items: line, width: lineWidth });
        line = [];
        lineWidth = 0;
      }
      lineWidth = line.length === 0 ? item.width : lineWidth + BADGE_NUMBER_GAP + item.width;
      line.push(item);
    }
    if (line.length > 0) lines.push({ items: line, width: lineWidth });

    const contentWidth = Math.max(...lines.map((entry) => entry.width));
    const width = contentWidth + BADGE_PADDING_X * 2;
    const height = lines.length * BADGE_LINE_HEIGHT + BADGE_PADDING_Y * 2;
    const firstLineY = -height / 2 + BADGE_PADDING_Y + BADGE_LINE_HEIGHT / 2;

    lines.forEach((entry, lineIndex) => {
      let left = -entry.width / 2;
      const y = firstLineY + lineIndex * BADGE_LINE_HEIGHT;
      for (const item of entry.items) {
        item.tspan.setAttribute("x", (left + item.width / 2).toFixed(2));
        item.tspan.setAttribute("y", y.toFixed(2));
        left += item.width + BADGE_NUMBER_GAP;
      }
    });

    pill.setAttribute("x", String(-width / 2));
    pill.setAttribute("y", String(-height / 2));
    pill.setAttribute("width", String(width));
    pill.setAttribute("height", String(height));
    const radius = Math.min(BADGE_RADIUS, height / 2);
    pill.setAttribute("rx", String(radius));
    pill.setAttribute("ry", String(radius));

    let x = anchor.x + BADGE_CLEARANCE + width / 2;
    let y = anchor.y;
    if (x + width / 2 > VIEW_SIZE - BADGE_EDGE) {
      const leftX = anchor.x - BADGE_CLEARANCE - width / 2;
      if (leftX - width / 2 >= BADGE_EDGE) {
        x = leftX;
      } else {
        x = Math.max(
          width / 2 + BADGE_EDGE,
          Math.min(anchor.x, VIEW_SIZE - width / 2 - BADGE_EDGE),
        );
        const above = anchor.y - BADGE_LABEL_CLEARANCE - height / 2;
        const below = anchor.y + BADGE_LABEL_CLEARANCE + height / 2;
        if (above - height / 2 >= BADGE_EDGE) y = above;
        else if (below + height / 2 <= VIEW_SIZE - BADGE_EDGE) y = below;
        else {
          y = Math.max(
            height / 2 + BADGE_EDGE,
            Math.min(anchor.y, VIEW_SIZE - height / 2 - BADGE_EDGE),
          );
        }
      }
    }
    badge.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);

    badgeNumberElements[index] = items;
    items.forEach(applyNumberState);
  }

  function update() {
    const guided = guideNumbers !== null;
    layout.tongues.forEach((tongue, index) => {
      const slot = session.slots[index];
      const numbers = guided ? guideNumbers.get(index) || [] : [];
      const active = guided
        ? guideCurrent !== null && numbers.includes(guideCurrent)
        : session.activeSlot === index;
      const element = tongueElements[index];

      element.classList.toggle("pending", slot === null);
      element.classList.toggle("done", slot !== null);
      element.classList.toggle("active", active);
      element.classList.toggle("guide-current", guided && active);
      element.setAttribute(
        "aria-label",
        ariaLabel(tongue, slot, active, numbers, guided ? guideCurrent : null),
      );

      if (active) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");

      noteElements[index].textContent = slot === null ? "" : slot.label;
      badgeElements[index].classList.toggle("hidden", numbers.length === 0);
      for (const item of badgeNumberElements[index]) applyNumberState(item);
    });
  }

  function setGuideMap(numbersByTongue) {
    guideCurrent = null;
    if (numbersByTongue === null) {
      guideNumbers = null;
    } else {
      guideNumbers = new Map();
      for (const [index, numbers] of numbersByTongue) {
        guideNumbers.set(index, [...numbers].sort((a, b) => a - b));
      }
    }

    layout.tongues.forEach((_, index) => {
      layoutBadge(index, guideNumbers ? guideNumbers.get(index) || [] : []);
    });
    update();
  }

  function setGuideProgress(number) {
    guideCurrent = typeof number === "number" ? number : null;
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

  return { element: svg, update, setGuideMap, setGuideProgress };
}
