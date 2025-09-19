# pull binary files
git lfs fetch --all
git lfs checkout

# get token
npm run get_token

# run simulation
npm run simulate -- \
  --external-scenarios "./test/scenarios/test-terminal-on-host" \
  --parallelism 1 \
  --sidebar \
  --n 1 \
  --disable-tools=get_errors,run_in_terminal \
  --in-extension-host \
  --scenario-workspace-folder \
  --verbose \
  --output "./test/scenarios/test-terminal-on-host/.out" \
  --skip-cache \
  --model "claude-sonnet-4"