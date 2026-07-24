const [actual, minimum] = process.argv.slice(2);

function parts(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? "")) process.exit(2);
  return value.split(".").map(Number);
}

const left = parts(actual);
const right = parts(minimum);
for (let index = 0; index < 3; index += 1) {
  if (left[index] > right[index]) process.exit(0);
  if (left[index] < right[index]) process.exit(1);
}
