import { useTranslation } from 'react-i18next';
import type { ButtonProps } from '@chakra-ui/react';
import { IconButton as ChakraIconButton } from '@chakra-ui/react';
import * as React from 'react';
import { LuX } from 'react-icons/lu';

export type CloseButtonProps = ButtonProps

export const CloseButton = React.forwardRef<
  HTMLButtonElement,
  CloseButtonProps
>((props, ref) => {
  const { t } = useTranslation();
  return (
    <ChakraIconButton variant="ghost" aria-label={t('accessibility.close')} ref={ref} {...props}>
      {props.children ?? <LuX />}
    </ChakraIconButton>
  );
});
