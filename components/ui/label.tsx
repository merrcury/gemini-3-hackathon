import * as React from "react";
import { Text, TextProps } from "react-native";

interface LabelProps extends TextProps {
  htmlFor?: string;
}

const Label = React.forwardRef<Text, LabelProps>(
  ({ children, style, ...props }, ref) => {
    return (
      <Text
        ref={ref}
        style={[{
          fontSize: 12,
          color: '#9CA3AF',
          marginBottom: 8,
          fontWeight: '500',
        }, style]}
        {...props}
      >
        {children}
      </Text>
    );
  }
);

Label.displayName = "Label";

export { Label };