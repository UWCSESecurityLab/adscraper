import Docker from 'dockerode';

const docker = new Docker();
(async () => {
  const containerInfos = await docker.listContainers({
    filters: { status: ['exited', 'created'] }
  });
  const containers = containerInfos
    .filter(containerInfo =>
        !!containerInfo.Names.find(name => name.startsWith('/crawler-') || name.startsWith('/wireguard-')))
    .map(containerInfo => docker.getContainer(containerInfo.Id));
  for (let container of containers) {
    console.log('Removing ' + container.id);
    try {
      await container.remove();
    } catch (e) {
      console.log(e);
    }
  }
})();