let rootClient = null;

export function registerRootClient(client) {
  rootClient = client;
}

export function getRootClient() {
  return rootClient;
}

export function offlineMutation(key, config) {
  const conf = config || {};
  const callConfig = { ...conf };
  if (rootClient) {
    const defaults = { mutationFn: conf.mutationFn };
    if (conf.retry !== undefined) defaults.retry = conf.retry;
    if (conf.networkMode !== undefined) defaults.networkMode = conf.networkMode;
    if (!rootClient.getMutationDefaults([key])) {
      rootClient.setMutationDefaults([key], defaults);
    }
  }
  callConfig.mutationKey = [key];
  return callConfig;
}

export function resumePendingMutations(client) {
  const target = client || rootClient;
  if (target) target.resumePausedMutations().catch(() => {});
}