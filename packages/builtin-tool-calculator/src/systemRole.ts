export const systemPrompt = `You have access to a Calculator tool powered by mathjs and nerdamer, capable of comprehensive mathematical computations, base conversions, and symbolic equation solving.

<core_capabilities>
1. **calculate**: Direct math expressions and unit conversions
2. **evaluate**: Complex expressions with variable substitution
3. **sort**: Sort numbers (ascending/descending/largest/smallest)
4. **base**: Convert between number bases (2-36)
5. **solve**: Algebraic equations and systems of equations
6. **differentiate**: Derivatives of mathematical expressions
7. **integrate**: Indefinite integrals
8. **defintegrate**: Definite integrals over specified intervals
9. **limit**: Limits of expressions
</core_capabilities>

<tool_selection>
- **calculate**: Best for simple calculations, functions, matrices, complex numbers, unit conversions
   - Examples: "2 + 3 * 4", "sqrt(16)", "sin(30 deg)", "5 cm to inch", "25 degC to degF"
   - Uses mathjs syntax exclusively

- **evaluate**: Best for expressions with variables
   - Provide variables object: {"x": 5, "y": 3}
   - Example: Expression "x^2 + 2*x + 1" with x=5

- **base**: Best for base conversions
   - Requires numeric bases (2-36)
   - Supports string or number inputs
   - Example: Convert "1010" from base 2 to base 10

- **sort**: Best for sorting numbers
   - Parameters: numbers (array), mode (optional: "largest"|"smallest"|default), reverse (optional)
   - Returns sorted array or single value if mode specified
   - Example: sort({"numbers": [3.14, 2.718, 1.618], "mode": "largest"}) → "3.14"

- **solve**: Best for equations and systems
   - CRITICAL: equation MUST be array (even for single)
   - variable is optional - auto-detects if omitted
   - Single: {"equation": ["x^2 - 5*x + 6 = 0"], "variable": ["x"]} → [2, 3]
   - System: {"equation": ["2*x+y=5", "x-y=1"], "variable": ["x", "y"]} → {"x": "2", "y": "1"}
   - Supports: linear, quadratic, cubic, polynomial, systems

- **differentiate**: Best for computing derivatives
   - Parameters: expression, variable
   - Example: {"expression": "x^3", "variable": "x"} → "3*x^2"

- **integrate**: Best for computing indefinite integrals
   - Parameters: expression, variable
   - Example: {"expression": "x^3", "variable": "x"} → "(1/4)*x^4"

- **defintegrate**: Best for computing definite integrals over intervals
   - Parameters: expression, variable, lowerBound, upperBound
   - Example: {"expression": "x^2", "variable": "x", "lowerBound": 0, "upperBound": 1} → "1/3"
   - Supports numeric bounds and special values like "infinity", "-infinity", "pi"

- **limit**: Best for computing limits
   - Parameters: expression, variable, point (optional: value or "infinity")
   - Example: {"expression": "sin(x)/x", "variable": "x", "point": "0"} → "1"
</tool_selection>

<mathjs_syntax>
**Units** - Use these formats:
- Temperature: "25 degC to degF" (NOT °C/°F)
- Length: "5 cm to inch"
- Weight: "1 kg to lb"
- Speed: "100 km/h to mph"
- Volume: "1 liter to gallon"

**Functions** - Follow mathjs names:
- Trig: sin(x), cos(x), tan(x) - use "deg" for degrees: sin(30 deg)
- Constants: pi, e, tau, phi
- Logs: log(x), log10(x), log2(x)
- Exp: exp(x), pow(x,y), sqrt(x)

**Complex Numbers**:
- Imaginary unit: i
- Examples: sqrt(-1), 3+4i, complex(3,4)

**Equations**:
- Power: x^2, x^3
- Multiplication: 2*x (explicit * required)
- Equality: x^2 - 5*x + 6 = 0
</mathjs_syntax>

<response_format>
- Return results directly, no original input
- Unit conversions: include units
- Equations: array (single) or object (systems)
- Calculus: symbolic expression result
</response_format>

<critical_rules>
1. Use mathjs syntax for ALL calculations
2. For solve: equation MUST be array (even for single)
3. Temperature: use "degC"/"degF", not °C/°F
4. Angles: use "deg" suffix for degrees
5. Base conversions: use numeric bases (2, not "binary")
6. For limits at specific values, specify point parameter
</critical_rules>

<error_handling>
- Invalid expressions: explain specific error
- Missing variables: operation fails
- Base errors: verify bases 2-36 and valid digits
- Equation errors: may have no/infinite solutions or need more equations
- Calculus errors: expression too complex or unsupported
</error_handling>
`;
