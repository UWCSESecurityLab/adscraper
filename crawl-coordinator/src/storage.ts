import Docker, { Container } from 'dockerode';
import { DB_VOLUME, DOCKER_NETWORK } from './constants';

export async function initVolume(docker: Docker): Promise<Docker.VolumeInspectInfo> {
  const volumes = await docker.listVolumes();
  const postgresVolume = volumes.Volumes.find((v) => v.Name === DB_VOLUME);
  if (!postgresVolume) {
    console.log('No volume detected, creating volume ' + DB_VOLUME);
    return docker.createVolume({ Name: DB_VOLUME });
  } else {
    console.log(DB_VOLUME + ' already exists, continuing');
    return postgresVolume;
  }
}

export async function initPostgres(docker: Docker) {
  const list = await docker.listContainers();
  const postgres = list.find((container) => {
    return container.Names.includes('/postgres')
        && (container.Image === 'postgres:latest' || container.Image === 'postgres-adscraper:latest')
        && container.HostConfig.NetworkMode === DOCKER_NETWORK;
  });

  if (!postgres || postgres.State === 'exited' ||
      postgres.State === 'dead' || postgres.State === 'removing') {
    if (!postgres) {
      console.log(`Postgres container doesn\'t exist yet, creating one`);
    } else {
      console.log(`Postgres container ${postgres.Id} is ${postgres.State}, creating a new container`);
    }

    const container = await docker.createContainer({
      name: 'postgres',
      ExposedPorts: { '5432/tcp': {} },
      HostConfig: {
        Binds: [`${DB_VOLUME}:/var/lib/postgresql/data`],
        NetworkMode: DOCKER_NETWORK,
        PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432'}]},
      },
      Image: 'postgres-adscraper:latest',
    });
    await container.start();
    console.log('Postgres started');
    return await container.inspect();
  } else {
    const container = docker.getContainer(postgres.Id);
    switch (postgres.State) {
      case 'created':
        console.log(`Postgres container ${postgres.Id} is created, starting it`);
        await container.start();
        break;
      case 'paused':
        console.log(`Postgres container ${postgres.Id} is paused, unpausing it`);
        await container.unpause();
        break;
      case 'restarted':
        console.log(`Postgres container ${postgres.Id} is restarting, uhhhhhhh`);
        break;
      case 'running':
        console.log(`Postgres container ${postgres.Id} is already running`);
        break;
      default:
        console.log(`Postgres container ${postgres.Id} is ${postgres.State}, unhandled case.`);
    }
    return await container.inspect();
  }
}

export async function initNetwork(docker: Docker) {
  console.log('Creating Docker network');
  const networks = await docker.listNetworks();
  const crawlerNetInfo = networks.find((n) => n.Name === DOCKER_NETWORK);
  let crawlerNet: Docker.Network;
  if (!crawlerNetInfo) {
    crawlerNet = await docker.createNetwork({
      Name: DOCKER_NETWORK,
      CheckDuplicate: true
    });
    console.log('Network created: ' + crawlerNet.id);
  } else {
    console.log('Network already exists');
    crawlerNet = docker.getNetwork(crawlerNetInfo.Id);
  }
  return crawlerNet.id;
}