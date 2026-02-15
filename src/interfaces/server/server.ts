import type { ServerContext } from './context';

interface ServerOptions {
  url: string;
  init?: (context?: ServerContext) => Promise<void>;
}

export declare function Server(
  options: ServerOptions,
): (
  target: new (preset?: any) => object,
  context: ClassDecoratorContext,
) => void;
