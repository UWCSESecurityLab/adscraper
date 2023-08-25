# Crawl cluster setup

## Pre-requisites

- Local / dev environment
  - Docker Desktop
  - `kubectl`
  - `minikube`
- Production environment
  - `containerd` or `cri-dockerd`
  - `kubectl`
  - `kubelet`
  - `kubeadm`

## Setup

1. Set up a cluster
    - Bootstrap control plane

2. Set up worker nodes
    - Install production environment dependencies
    - Add nodes to cluster

3. Set up a location for storing input and output files
    - Input folder (crawl input lists, job specifications)
    - Output folder (screenshot files, log files)
    - Crawler profiles
    - If using a network volume, then modify `job.yaml` so that each crawl
      worker has the volume mounted

4. Set up message queue service

```sh
kubectl create -f https://raw.githubusercontent.com/kubernetes/kubernetes/release-1.3/examples/celery-rabbitmq/rabbitmq-service.yaml
kubectl create -f https://raw.githubusercontent.com/kubernetes/kubernetes/release-1.3/examples/celery-rabbitmq/rabbitmq-controller.yaml
```

4. Set up network policy to allow egress for crawls

```sh
kubectl apply -f ./networkpolicy.yaml
```

5. Set up a database
    - Runs outside of Kubernetes

6. Create a job specification file
    - See `jobspec.ts`
    - Includes:
      - Database credentials
      - Network mount info?


## Run a crawl job

On the control plane node, run `node runjob.js` with the job specification file.


## TODOs

- Figure out the jobspec format
- Figure out container mounts in job.yaml
- Write a script that creates/modifies job.yaml based on the jobspec (number of crawls, mounts, etc.)
- Figure out the crawlspec that goes into the message queue
- Write the interface for running containers from crawlspecs
- Figure out the command to run the crawl container
