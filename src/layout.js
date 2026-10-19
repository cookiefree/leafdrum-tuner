const GROUP_NAMES = [
  "Center",
  "Top",
  "Top-right",
  "Right",
  "Bottom-right",
  "Bottom",
  "Bottom-left",
  "Left",
  "Top-left",
];

const SIZES = ["big", "middle", "small"];

function idPart(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const tongues = [];

for (const groupName of GROUP_NAMES) {
  for (const size of SIZES) {
    tongues.push({
      id: `${idPart(groupName)}-${size}`,
      groupName,
      size,
      label: `${groupName}, ${size}`,
    });
  }
}

const layout = {
  id: "nested-9x3",
  name: "Nested 9 x 3",
  tongues,
};

export default layout;
