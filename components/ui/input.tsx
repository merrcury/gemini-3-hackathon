import * as React from "react";
import { TextInput, TextInputProps } from "react-native";

interface InputProps extends TextInputProps {
  className?: string;
}

const Input = React.forwardRef<TextInput, InputProps>(
  ({ style, ...props }, ref) => {
    return (
      <TextInput
        ref={ref}
        style={[{
          height: 48,
          width: '100%',
          borderRadius: 24,
          paddingHorizontal: 44,
          fontSize: 14,
          color: '#FFFFFF',
          backgroundColor: 'rgba(55, 65, 81, 0.3)',
          borderWidth: 1,
          borderColor: '#374151',
        }, style]}
        placeholderTextColor="#6B7280"
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };