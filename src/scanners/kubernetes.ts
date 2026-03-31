import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

const execAsync = promisify(exec);

/** Minimal shape of a K8s CronJob from `kubectl get cronjobs -o json` */
interface K8sCronJobList {
  items: K8sCronJob[];
}

interface K8sCronJob {
  metadata: {
    name: string;
    namespace: string;
    annotations?: Record<string, string>;
  };
  spec: {
    schedule: string;
    suspend?: boolean;
    jobTemplate: {
      spec: {
        template: {
          spec: {
            containers: Array<{
              name: string;
              image: string;
            }>;
          };
        };
      };
    };
  };
  status?: {
    lastScheduleTime?: string;
  };
}

export class KubernetesScanner implements Scanner {
  name = "kubernetes";

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("which kubectl");
      return true;
    } catch {
      return false;
    }
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    try {
      const { stdout } = await execAsync("kubectl get cronjobs -A -o json");
      const list: K8sCronJobList = JSON.parse(stdout);

      for (const cronJob of list.items) {
        const { metadata, spec, status } = cronJob;
        const fullName = `${metadata.namespace}/${metadata.name}`;
        const schedule = spec.schedule;

        let nextRun: Date | undefined;
        let interval: string | undefined;
        try {
          const parsed = parseCronExpression(schedule);
          nextRun = parsed.nextRun;
          interval = parsed.interval;
        } catch {
          // Schedule couldn't be parsed
        }

        const containers = spec.jobTemplate.spec.template.spec.containers;
        const image = containers.length > 0 ? containers[0].image : undefined;
        const description =
          metadata.annotations?.["description"] ??
          metadata.annotations?.["kubernetes.io/description"] ??
          undefined;

        const taskMetadata: Record<string, string> = {
          namespace: metadata.namespace,
        };
        if (image) taskMetadata.image = image;
        if (status?.lastScheduleTime) taskMetadata.lastScheduleTime = status.lastScheduleTime;
        if (spec.suspend) taskMetadata.suspended = "true";

        const task: ScheduledTask = {
          name: fullName,
          schedule,
          source: "kubernetes",
          nextRun,
          interval,
          command: image,
          metadata: taskMetadata,
          ...(description ? { description } : {}),
        };

        tasks.push(task);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("command not found") ||
        message.includes("connection refused") ||
        message.includes("Unable to connect") ||
        message.includes("EACCES") ||
        message.includes("couldn't get current server API group list")
      ) {
        return [];
      }
      return [];
    }

    return tasks;
  }
}
