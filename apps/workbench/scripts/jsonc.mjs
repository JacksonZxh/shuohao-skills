export function parseJsonc(input) {
  let output = "";
  let index = 0;
  let inString = false;
  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index += 2;
        continue;
      }
      if (char === "\"") inString = false;
      index += 1;
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, "$1"));
}
