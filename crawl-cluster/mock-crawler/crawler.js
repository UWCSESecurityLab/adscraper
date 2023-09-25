
process.stdin.on('data', data => {
  console.log(data.toString());
});

setTimeout(() => {
  process.exit(0);
}, 5000);
