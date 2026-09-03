import {factory} from 'mathjs';

type CustomFactory = (
  name: string,
  dependencies: string[],
  create: (dependencies: Record<string, unknown>) => unknown,
  meta?: Record<string, unknown>
) => ReturnType<typeof factory>;

export const customFactory = factory as unknown as CustomFactory;
